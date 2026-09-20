use super::{projection::Projection, Options, Outcome, Result, MAX_BYTES};
use crate::source_refresh::disk::Cache;
use rustix::{
    fs::{fcntl_getfl, fcntl_setfl, OFlags},
    process::{kill_process_group, waitid, Pid, Signal, WaitId, WaitIdOptions},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::Metadata,
    io::{ErrorKind, Read},
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt},
        process::{CommandExt, ExitStatusExt},
    },
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const STDERR_CAP: usize = 4 * 1024 * 1024;
const DRAIN: Duration = Duration::from_secs(2);
const EXEC_CAP: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    schema_version: u32,
    client: String,
    provider_family: String,
    executable_identity: String,
    executable_sha256: String,
}
struct Executable {
    path: PathBuf,
    binding: Binding,
    identity: (u64, u64, u64, i64, i64, i64, i64),
}
fn stamp(meta: &Metadata) -> (u64, u64, u64, i64, i64, i64, i64) {
    (
        meta.dev(),
        meta.ino(),
        meta.len(),
        meta.mtime(),
        meta.mtime_nsec(),
        meta.ctime(),
        meta.ctime_nsec(),
    )
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
impl Executable {
    fn read(path: &Path) -> Result<Self> {
        use std::os::unix::ffi::OsStrExt;
        if !path.is_absolute()
            || path.as_os_str().as_bytes().len() > 4096
            || path
                .components()
                .any(|v| matches!(v, Component::ParentDir | Component::CurDir))
        {
            return Err("capture_executable_invalid");
        }
        let canonical =
            std::fs::canonicalize(path).map_err(|_| "capture_executable_unavailable")?;
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
            .open(&canonical)
            .map_err(|_| "capture_executable_unavailable")?;
        let before = file
            .metadata()
            .map_err(|_| "capture_executable_unavailable")?;
        if !before.is_file()
            || before.len() == 0
            || before.len() > EXEC_CAP
            || before.mode() & 0o111 == 0
            || before.mode() & 0o022 != 0
            || (before.uid() != 0 && before.uid() != rustix::process::geteuid().as_raw())
        {
            return Err("capture_executable_invalid");
        }
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 65536];
        let mut length = 0u64;
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|_| "capture_executable_read_failed")?;
            if count == 0 {
                break;
            }
            length = length
                .checked_add(count as u64)
                .ok_or("capture_executable_invalid")?;
            if length > EXEC_CAP {
                return Err("capture_executable_invalid");
            }
            digest.update(&buffer[..count]);
        }
        let after = file
            .metadata()
            .map_err(|_| "capture_executable_unavailable")?;
        let named =
            std::fs::symlink_metadata(&canonical).map_err(|_| "capture_executable_unavailable")?;
        if length != before.len()
            || stamp(&before) != stamp(&after)
            || stamp(&before) != stamp(&named)
            || !named.is_file()
        {
            return Err("capture_executable_changed");
        }
        let mut identity = Sha256::new();
        identity.update(b"aicharts:mcode-executable:v1\0");
        identity.update(canonical.as_os_str().as_bytes());
        identity.update(before.dev().to_le_bytes());
        identity.update(before.ino().to_le_bytes());
        Ok(Self {
            path: canonical,
            identity: stamp(&before),
            binding: Binding {
                schema_version: 1,
                client: "mcode".into(),
                provider_family: "mcode-runtime".into(),
                executable_identity: hex(&identity.finalize()),
                executable_sha256: hex(&digest.finalize()),
            },
        })
    }
    fn current(&self) -> Result<()> {
        let fresh = Self::read(&self.path)?;
        if fresh.identity != self.identity || fresh.binding != self.binding {
            return Err("capture_executable_changed");
        }
        Ok(())
    }
}

struct OwnedGroup {
    child: Child,
    pid: Pid,
    closed: bool,
}
impl OwnedGroup {
    fn spawn(command: &mut Command) -> Result<Self> {
        let mut child = command
            .process_group(0)
            .spawn()
            .map_err(|_| "capture_spawn_failed")?;
        let pid = i32::try_from(child.id())
            .ok()
            .filter(|v| *v > 1)
            .and_then(Pid::from_raw);
        let Some(pid) = pid.filter(|pid| *pid != rustix::process::getpgrp()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("capture_process_identity_invalid");
        };
        Ok(Self {
            child,
            pid,
            closed: false,
        })
    }
    fn exited(&mut self) -> Result<bool> {
        // Retain the leader's identity until group cleanup; try_wait would reap
        // it and make a later numeric group signal unsafe after PID reuse.
        match waitid(
            WaitId::Pid(self.pid),
            WaitIdOptions::EXITED | WaitIdOptions::NOHANG | WaitIdOptions::NOWAIT,
        ) {
            Ok(value) => Ok(value.is_some()),
            Err(_) => {
                self.closed = true;
                Err("capture_process_custody_lost")
            }
        }
    }
    fn finish(&mut self) -> Result<std::process::ExitStatus> {
        if self.closed {
            return Err("capture_process_custody_lost");
        }
        match kill_process_group(self.pid, Signal::KILL) {
            Ok(()) | Err(rustix::io::Errno::SRCH) => (),
            // Darwin reports EPERM for a group containing only a zombie. Do
            // not accept generic EPERM: retain the exited leader with WNOWAIT
            // and require the complete kernel group list to contain only it.
            #[cfg(target_os = "macos")]
            Err(rustix::io::Errno::PERM)
                if self.exited()?
                    && aicharts_platform_process::groups::contains_only_leader(
                        self.pid.as_raw_nonzero().get(),
                    )? => {}
            Err(_) => return Err("capture_process_cleanup_failed"),
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    self.closed = true;
                    return Ok(status);
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                Err(error)
                    if error.kind() == ErrorKind::Interrupted && Instant::now() < deadline =>
                {
                    continue;
                }
                _ => {
                    self.closed = true;
                    return Err("capture_process_cleanup_failed");
                }
            }
        }
    }
}
impl Drop for OwnedGroup {
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.finish();
        }
    }
}
fn now() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "capture_clock_invalid")?
        .as_millis()
        .try_into()
        .map_err(|_| "capture_clock_invalid")
}
fn nonblocking(fd: &impl std::os::fd::AsFd) -> Result<()> {
    let flags = fcntl_getfl(fd).map_err(|_| "capture_pipe_unavailable")?;
    fcntl_setfl(fd, flags | OFlags::NONBLOCK).map_err(|_| "capture_pipe_unavailable")
}
fn outcome(code: i32, error: &'static str) -> Result<Outcome> {
    Ok(Outcome {
        summary: serde_json::to_string(
            &json!({"client":"mcode","captured":false,"error":error,"exitCode":code}),
        )
        .map_err(|_| "capture_report_invalid")?,
        exit_code: code,
    })
}

pub(super) fn capture(options: &Options) -> Result<Outcome> {
    let executable = Executable::read(&options.executable)?;
    let cache = Cache::open(&options.cache)?;
    cache.require_entries(&["refresh.lock", "profile.json", "usage.jsonl"])?;
    let manifest = cache.read("profile.json", 4096)?;
    if let Some(bytes) = &manifest {
        let binding: Binding =
            serde_json::from_slice(bytes).map_err(|_| "capture_profile_invalid")?;
        if binding != executable.binding {
            return Err("capture_executable_profile_mismatch");
        }
    }
    let previous = cache.read("usage.jsonl", MAX_BYTES)?;
    if manifest.is_none() && previous.is_some() {
        return Err("capture_cache_unbound");
    }
    // Validate existing numeric history before asking the user's tool to do work.
    if let Some(bytes) = &previous {
        Projection::validate_cache(bytes)?;
    }
    executable.current()?;
    let signals = aicharts_platform_process::signals::CancellationScope::open()?;
    let mut group = OwnedGroup::spawn(
        Command::new(&executable.path)
            .args(&options.args)
            .stdin(Stdio::inherit())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )?;
    let mut stdout = group
        .child
        .stdout
        .take()
        .ok_or("capture_pipe_unavailable")?;
    let mut stderr = group
        .child
        .stderr
        .take()
        .ok_or("capture_pipe_unavailable")?;
    nonblocking(&stdout)?;
    nonblocking(&stderr)?;
    let started = Instant::now();
    let mut exited_at = None;
    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut stdout_bytes = 0usize;
    let mut stderr_bytes = 0usize;
    let mut projection = Projection::default();
    let mut failure = None;
    let mut buffer = [0u8; 8192];
    loop {
        if signals.cancelled().is_some() {
            failure = Some("capture_cancelled");
            break;
        }
        if started.elapsed() >= options.timeout {
            failure = Some("capture_timeout");
            break;
        }
        if group.exited()? && exited_at.is_none() {
            exited_at = Some(Instant::now());
        }
        if exited_at.is_some_and(|at| at.elapsed() >= DRAIN) && !(stdout_done && stderr_done) {
            failure = Some("capture_pipe_incomplete");
            break;
        }
        if !stdout_done {
            for _ in 0..8 {
                match stdout.read(&mut buffer) {
                    Ok(0) => {
                        stdout_done = true;
                        break;
                    }
                    Ok(count) => {
                        stdout_bytes += count;
                        if stdout_bytes > MAX_BYTES {
                            failure = Some("capture_stdout_limit");
                            break;
                        }
                        if let Err(error) = projection.push(&buffer[..count], now()?) {
                            failure = Some(error);
                            break;
                        }
                    }
                    Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                    Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                    Err(_) => {
                        failure = Some("capture_stdout_read_failed");
                        break;
                    }
                }
            }
        }
        if failure.is_some() {
            break;
        }
        if !stderr_done {
            for _ in 0..8 {
                match stderr.read(&mut buffer) {
                    Ok(0) => {
                        stderr_done = true;
                        break;
                    }
                    Ok(count) => {
                        stderr_bytes += count;
                        if stderr_bytes > STDERR_CAP {
                            failure = Some("capture_stderr_limit");
                            break;
                        }
                    }
                    Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                    Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                    Err(_) => {
                        failure = Some("capture_stderr_read_failed");
                        break;
                    }
                }
            }
        }
        if failure.is_some() || (exited_at.is_some() && stdout_done && stderr_done) {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let status = group.finish()?;
    let code = status
        .code()
        .unwrap_or_else(|| 128 + status.signal().unwrap_or(1));
    if let Some(error) = failure {
        let failed_code = if error == "capture_timeout" {
            124
        } else if error == "capture_cancelled" {
            128 + signals.cancelled().unwrap_or(libc::SIGTERM)
        } else {
            status.code().filter(|code| *code != 0).unwrap_or(1)
        };
        return outcome(failed_code, error);
    }
    if code != 0 {
        return outcome(code, "capture_child_failed");
    }
    projection.finish(now()?)?;
    executable.current()?;
    let bytes = projection.merge(previous.as_deref())?;
    if let Some(signal) = signals.cancelled() {
        return outcome(128 + signal, "capture_cancelled");
    }
    if manifest.is_none() {
        cache.create_binding(
            &serde_json::to_vec(&executable.binding).map_err(|_| "capture_profile_invalid")?,
        )?;
    }
    cache.replace("usage.jsonl", &bytes)?;
    Ok(Outcome { summary: serde_json::to_string(&json!({"client":"mcode","captured":true,"records":projection.records(),"cacheBytes":bytes.len(),"historyPolicy":"completed_turns_deduplicated"})).map_err(|_| "capture_report_invalid")?, exit_code: 0 })
}

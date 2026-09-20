//! Native identity reads never format argv, tokens, or command output into errors.
use super::Result;
#[cfg(target_os = "macos")]
use super::{hashed, remaining};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
#[cfg(any(target_os = "macos", test))]
const INVALID: &str = "antigravity_refresh_process_unqualified";
#[derive(Clone, PartialEq, Eq)]
pub(super) struct Identity {
    pub pid: u32,
    pub uid: u32,
    pub started: (u64, u64),
    pub executable: PathBuf,
    pub app: PathBuf,
    pub executable_stamp: (u64, u64, u64, i64, i64, i64, i64),
    pub csrf: String,
}
#[cfg(any(target_os = "macos", test))]
fn executable_allowed(path: &Path, app: &Path) -> bool {
    path.starts_with(app.join("Contents"))
        && path
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v == "language_server" || v.starts_with("language_server_"))
}
#[cfg(any(target_os = "macos", test))]
fn csrf(args: &[String]) -> Result<String> {
    let mut found = None;
    for (index, arg) in args.iter().enumerate() {
        let value = if arg == "--csrf_token" {
            args.get(index + 1).map(String::as_str)
        } else {
            arg.strip_prefix("--csrf_token=")
        };
        if let Some(value) = value {
            if found.is_some()
                || !(32..=128).contains(&value.len())
                || !value.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
            {
                return Err(INVALID);
            }
            found = Some(value.to_owned())
        }
    }
    found.ok_or(INVALID)
}
#[cfg(any(target_os = "macos", test))]
fn parse_ports(bytes: &[u8], pid: u32, uid: u32) -> Result<Vec<u16>> {
    let text = std::str::from_utf8(bytes).map_err(|_| INVALID)?;
    let mut ports = std::collections::BTreeSet::new();
    let (mut saw_pid, mut saw_uid) = (false, false);
    let (mut descriptor, mut family, mut name) = (false, None, None);
    let mut finish = |family: Option<&str>, name: Option<&str>| -> Result<()> {
        if family != Some("IPv4") {
            return Ok(());
        }
        let (host, port) = name.ok_or(INVALID)?.rsplit_once(':').ok_or(INVALID)?;
        if matches!(host, "127.0.0.1" | "0.0.0.0" | "*") {
            ports.insert(port.parse::<u16>().ok().filter(|v| *v > 0).ok_or(INVALID)?);
        }
        Ok(())
    };
    for line in text.lines() {
        if let Some(value) = line.strip_prefix('p') {
            if saw_pid || descriptor || value.parse::<u32>().ok() != Some(pid) {
                return Err(INVALID);
            }
            saw_pid = true
        } else if let Some(value) = line.strip_prefix('u') {
            if !saw_pid || saw_uid || descriptor || value.parse::<u32>().ok() != Some(uid) {
                return Err(INVALID);
            }
            saw_uid = true
        } else if let Some(value) = line.strip_prefix('f') {
            if !saw_uid || value.is_empty() {
                return Err(INVALID);
            }
            finish(family, name)?;
            descriptor = true;
            family = None;
            name = None;
        } else if let Some(value) = line.strip_prefix('t') {
            if !descriptor || family.replace(value).is_some() {
                return Err(INVALID);
            }
        } else if let Some(value) = line.strip_prefix('n') {
            if !descriptor || name.replace(value).is_some() {
                return Err(INVALID);
            }
        }
    }
    finish(family, name)?;
    if !saw_pid || !saw_uid || ports.is_empty() || ports.len() > 16 {
        return Err(INVALID);
    }
    Ok(ports.into_iter().collect())
}
#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use std::{
        fs,
        io::{ErrorKind, Read},
        os::unix::{fs::MetadataExt, process::CommandExt},
        process::{Command, Stdio},
        thread,
    };
    fn check_path(path: &Path, directory: bool) -> Result<fs::Metadata> {
        if !path.is_absolute() || path.as_os_str().len() > 4096 {
            return Err(INVALID);
        }
        let mut current = PathBuf::from("/");
        for component in path.components() {
            match component {
                std::path::Component::RootDir => {}
                std::path::Component::Normal(name) => {
                    current.push(name);
                    if fs::symlink_metadata(&current)
                        .map_err(|_| INVALID)?
                        .file_type()
                        .is_symlink()
                    {
                        return Err(INVALID);
                    }
                }
                _ => return Err(INVALID),
            }
        }
        let metadata = fs::metadata(path).map_err(|_| INVALID)?;
        let uid = rustix::process::geteuid().as_raw();
        if metadata.is_dir() != directory
            || (!directory && !metadata.is_file())
            || metadata.uid() != 0 && metadata.uid() != uid
            || metadata.mode() & 0o022 != 0
        {
            return Err(INVALID);
        }
        Ok(metadata)
    }
    fn app(path: &Path) -> Result<PathBuf> {
        check_path(path, true)?;
        if !path
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.to_ascii_lowercase().contains("antigravity") && v.ends_with(".app"))
        {
            return Err(INVALID);
        }
        Ok(path.to_path_buf())
    }
    fn snapshot(pid: u32, app: &Path) -> Result<Identity> {
        let (uid, executable) = aicharts_platform_process::identity(pid).map_err(|_| INVALID)?;
        if !executable_allowed(&executable, app) {
            return Err(INVALID);
        }
        let metadata = check_path(&executable, false)?;
        let info = aicharts_platform_process::snapshot(pid).map_err(|_| INVALID)?;
        if info.uid != uid || info.executable != executable {
            return Err(INVALID);
        }
        let csrf = csrf(&info.arguments)?;
        Ok(Identity {
            pid,
            uid,
            started: info.started,
            executable,
            app: app.to_path_buf(),
            executable_stamp: (
                metadata.dev(),
                metadata.ino(),
                metadata.len(),
                metadata.mtime(),
                metadata.ctime(),
                metadata.mtime_nsec(),
                metadata.ctime_nsec(),
            ),
            csrf,
        })
    }
    fn ports(identity: &Identity, budget: Duration) -> Result<Vec<u16>> {
        let mut child = Command::new("/usr/sbin/lsof")
            .args([
                "-nP",
                "-l",
                "-a",
                "-p",
                &identity.pid.to_string(),
                "-iTCP",
                "-sTCP:LISTEN",
                "-Fpuftn",
            ])
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|_| INVALID)?;
        let outcome = (|| {
            let mut stdout = child.stdout.take().ok_or(INVALID)?;
            let flags = rustix::fs::fcntl_getfl(&stdout).map_err(|_| INVALID)?;
            rustix::fs::fcntl_setfl(&stdout, flags | rustix::fs::OFlags::NONBLOCK)
                .map_err(|_| INVALID)?;
            let started = Instant::now();
            let mut bytes = Vec::new();
            let mut exited = None;
            let mut eof = false;
            loop {
                let mut buffer = [0u8; 4096];
                match stdout.read(&mut buffer) {
                    Ok(0) => eof = true,
                    Ok(n) => {
                        if bytes.len() + n > 64 * 1024 {
                            return Err(INVALID);
                        }
                        bytes.extend_from_slice(&buffer[..n]);
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(_) => return Err(INVALID),
                }
                if exited.is_none() {
                    exited = child.try_wait().map_err(|_| INVALID)?
                }
                if let Some(status) = exited {
                    if eof {
                        if !status.success() {
                            return Err(INVALID);
                        }
                        return parse_ports(&bytes, identity.pid, identity.uid);
                    }
                }
                if started.elapsed() >= budget.min(Duration::from_secs(3)) {
                    return Err(INVALID);
                }
                thread::sleep(Duration::from_millis(5));
            }
        })();
        if outcome.is_err() {
            let _ = child.kill();
            let _ = child.wait();
        }
        outcome
    }
    pub(super) fn discover(
        path: &Path,
        pid: Option<u32>,
        port: Option<u16>,
        started: Instant,
    ) -> Result<Vec<(Identity, Vec<u16>)>> {
        let app = app(path)?;
        let pids = if let Some(pid) = pid {
            vec![pid]
        } else {
            aicharts_platform_process::pids().map_err(|_| INVALID)?
        };
        let mut found = Vec::new();
        for id in pids {
            remaining(started)?;
            let Ok((_, exe)) = aicharts_platform_process::identity(id) else {
                continue;
            };
            if !executable_allowed(&exe, &app) {
                continue;
            }
            let identity = snapshot(id, &app)?;
            let mut ports = ports(&identity, remaining(started)?)?;
            if let Some(port) = port {
                ports.retain(|p| *p == port)
            }
            if ports.is_empty() {
                continue;
            }
            found.push((identity, ports));
            if found.len() > 8 {
                return Err("antigravity_refresh_limit");
            }
        }
        if found.is_empty() {
            return Err("antigravity_refresh_process_not_found");
        }
        Ok(found)
    }
    pub(super) fn validate(identity: &Identity, port: u16, budget: Duration) -> Result<()> {
        let started = Instant::now();
        app(&identity.app)?;
        if snapshot(identity.pid, &identity.app)? != *identity {
            return Err(INVALID);
        }
        let remaining = budget
            .checked_sub(started.elapsed())
            .filter(|v| !v.is_zero())
            .ok_or(INVALID)?;
        if !ports(identity, remaining)?.contains(&port) || started.elapsed() >= budget {
            return Err(INVALID);
        }
        Ok(())
    }
    pub(super) fn scope(path: &Path) -> Result<String> {
        let app = app(path)?;
        Ok(hashed(
            "installation",
            &format!(
                "{}\0{}",
                rustix::process::geteuid().as_raw(),
                app.to_str().ok_or(INVALID)?
            ),
        ))
    }
}
#[cfg(target_os = "macos")]
pub(super) fn discover(
    path: &Path,
    pid: Option<u32>,
    port: Option<u16>,
    started: Instant,
) -> Result<Vec<(Identity, Vec<u16>)>> {
    native::discover(path, pid, port, started)
}
#[cfg(target_os = "macos")]
pub(super) fn validate(identity: &Identity, port: u16, budget: Duration) -> Result<()> {
    native::validate(identity, port, budget)
}
#[cfg(target_os = "macos")]
pub(super) fn scope(path: &Path) -> Result<String> {
    native::scope(path)
}
#[cfg(not(target_os = "macos"))]
pub(super) fn discover(
    _: &Path,
    _: Option<u32>,
    _: Option<u16>,
    _: Instant,
) -> Result<Vec<(Identity, Vec<u16>)>> {
    Err("antigravity_refresh_requires_macos")
}
#[cfg(not(target_os = "macos"))]
pub(super) fn validate(_: &Identity, _: u16, _: Duration) -> Result<()> {
    Err("antigravity_refresh_requires_macos")
}
#[cfg(not(target_os = "macos"))]
pub(super) fn scope(_: &Path) -> Result<String> {
    Err("antigravity_refresh_requires_macos")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spoofed_executable_uid_pid_and_port_are_rejected() {
        let app = Path::new("/Applications/Antigravity.app");
        assert!(executable_allowed(
            Path::new("/Applications/Antigravity.app/Contents/Resources/language_server_macos_arm"),
            app
        ));
        for path in [
            "/Applications/Other.app/Contents/language_server",
            "/Applications/Antigravity.app.evil/Contents/language_server",
            "/Applications/Antigravity.app/Contents/helper",
        ] {
            assert!(!executable_allowed(Path::new(path), app))
        }
        assert_eq!(
            parse_ports(b"p42\nu501\nf21\ntIPv4\nn127.0.0.1:4444\n", 42, 501).unwrap(),
            [4444]
        );
        assert!(parse_ports(b"p43\nu501\nf21\ntIPv4\nn127.0.0.1:4444\n", 42, 501).is_err());
        assert!(parse_ports(b"p42\nu502\nf21\ntIPv4\nn127.0.0.1:4444\n", 42, 501).is_err());
        assert!(parse_ports(b"p42\nu501\nf21\ntIPv4\nn192.0.2.1:4444\n", 42, 501).is_err());
    }
    #[test]
    fn listener_family_is_bound_to_each_descriptor() {
        for bytes in [
            "p42\nu501\nf21\ntIPv6\nn[::1]:4444\n",
            "p42\nu501\nf21\ntIPv6\nn*:4444\n",
            "p42\nu501\nf21\nn127.0.0.1:4444\n",
            "p42\nu501\nn127.0.0.1:4444\n",
        ] {
            assert!(parse_ports(bytes.as_bytes(), 42, 501).is_err());
        }
        assert_eq!(
            parse_ports(
                b"p42\nu501\nf21\ntIPv4\nn*:4444\nf22\ntIPv6\nn*:5555\nf23\nn127.0.0.1:6666\n",
                42,
                501
            )
            .unwrap(),
            [4444]
        );
    }
    #[test]
    fn csrf_is_exact_bounded_and_unambiguous() {
        let token = "a".repeat(32);
        assert_eq!(
            csrf(&["binary".into(), format!("--csrf_token={token}")]).unwrap(),
            token
        );
        assert!(csrf(&["--not_csrf_token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()]).is_err());
        assert!(csrf(&[
            format!("--csrf_token={token}"),
            format!("--csrf_token={token}")
        ])
        .is_err());
        assert!(csrf(&["--csrf_token=not-secret".into()]).is_err());
    }
}

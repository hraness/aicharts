//! Shared custody of one retained child leader and its process group.
//! Cooperative descendants must remain in that group; this is not a sandbox
//! against a child that calls setsid/setpgid to escape its delegated lifetime.
use rustix::process::{kill_process_group, waitid, Pid, Signal, WaitId, WaitIdOptions};
use std::{
    os::unix::process::CommandExt,
    process::{Child, Command},
    time::{Duration, Instant},
};
type Result<T> = std::result::Result<T, &'static str>;
pub(crate) struct OwnedGroup {
    pub(crate) child: Child,
    pid: Pid,
    closed: bool,
}
impl OwnedGroup {
    pub(crate) fn spawn(command: &mut Command) -> Result<Self> {
        aicharts_platform_process::signals::require_child_wait_custody()?;
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
            let deadline = Instant::now() + Duration::from_secs(5);
            while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            return Err("capture_process_identity_invalid");
        };
        Ok(Self {
            child,
            pid,
            closed: false,
        })
    }
    pub(crate) fn exited(&mut self) -> Result<bool> {
        // Retain the leader's identity until group cleanup; try_wait would reap
        // it and make a later numeric group signal unsafe after PID reuse.
        for _ in 0..16 {
            match waitid(
                WaitId::Pid(self.pid),
                WaitIdOptions::EXITED | WaitIdOptions::NOHANG | WaitIdOptions::NOWAIT,
            ) {
                Ok(value) => return Ok(value.is_some()),
                Err(rustix::io::Errno::INTR) => continue,
                Err(_) => {
                    self.closed = true;
                    return Err("capture_process_custody_lost");
                }
            }
        }
        // Interruptions do not establish custody loss. Keep the retained leader
        // available for the bounded cleanup attempt performed by Drop.
        Err("capture_process_wait_unavailable")
    }
    pub(crate) fn finish(&mut self) -> Result<std::process::ExitStatus> {
        if self.closed {
            return Err("capture_process_custody_lost");
        }
        // ECHILD means ownership was lost; never signal a recyclable group id.
        self.exited()?;
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
        // Keep the leader pinned until every member of its process group has
        // settled. SIGKILL delivery alone does not prove descendant completion.
        loop {
            self.exited()?;
            if aicharts_platform_process::groups::contains_only_leader(
                self.pid.as_raw_nonzero().get(),
            )? {
                break;
            }
            if Instant::now() >= deadline {
                return Err("capture_process_cleanup_failed");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
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
                    if error.kind() == std::io::ErrorKind::Interrupted
                        && Instant::now() < deadline =>
                {
                    continue
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::DirBuilderExt, process::Stdio};
    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            let mut random = [0; 16];
            getrandom::fill(&mut random).unwrap();
            let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
            let path = std::env::temp_dir().join(format!("aicharts-owned-group-{suffix}"));
            fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn wait_exit(group: &mut OwnedGroup) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !group.exited().unwrap() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    #[test]
    fn early_leader_exit_still_settles_its_owned_descendant_before_return() {
        let scratch = Scratch::new();
        let marker = scratch.0.join("late-effect");
        let mut group = OwnedGroup::spawn(
            Command::new("/bin/sh")
                .args([
                    "-c",
                    "(sleep 1; printf escaped > \"$1\") & exit 0",
                    "owned-test",
                ])
                .arg(&marker)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null()),
        )
        .unwrap();
        wait_exit(&mut group);
        assert!(group.finish().unwrap().success());
        std::thread::sleep(Duration::from_millis(1100));
        assert!(!marker.exists());
    }
    #[test]
    fn lost_child_wait_custody_refuses_before_group_signalling() {
        let mut group = OwnedGroup::spawn(Command::new("/bin/sh").args(["-c", "exit 0"])).unwrap();
        // Deliberately simulate another owner reaping the retained leader.
        assert!(group.child.wait().unwrap().success());
        assert_eq!(group.finish().unwrap_err(), "capture_process_custody_lost");
        assert!(group.closed);
    }
    #[test]
    fn running_group_cleanup_is_bounded_and_reaps_the_leader() {
        let mut group =
            OwnedGroup::spawn(Command::new("/bin/sh").args(["-c", "sleep 30 & wait"])).unwrap();
        let start = Instant::now();
        let status = group.finish().unwrap();
        assert!(!status.success());
        assert!(start.elapsed() < Duration::from_secs(6));
        assert!(group.closed);
    }
}

//! Scoped signal observation for an owned subprocess lifecycle.
//! Handlers do no allocation, locking, I/O, or process manipulation.
static CAPTURE_SCOPE: std::sync::Mutex<()> = std::sync::Mutex::new(());
static CANCELLED: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
extern "C" fn cancel(signal: libc::c_int) {
    let _ = CANCELLED.compare_exchange(
        0,
        signal,
        std::sync::atomic::Ordering::Relaxed,
        std::sync::atomic::Ordering::Relaxed,
    );
}
pub struct CancellationScope {
    _guard: std::sync::MutexGuard<'static, ()>,
    previous: Vec<(libc::c_int, libc::sigaction)>,
}
impl CancellationScope {
    pub fn open() -> std::result::Result<Self, &'static str> {
        let guard = CAPTURE_SCOPE
            .try_lock()
            .map_err(|_| "capture_signal_scope_busy")?;
        CANCELLED.store(0, std::sync::atomic::Ordering::Relaxed);
        let mut scope = Self {
            _guard: guard,
            previous: Vec::new(),
        };
        for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP, libc::SIGQUIT] {
            // The handler only stores a lock-free integer; cleanup runs in the
            // ordinary capture loop. Save and restore each process disposition.
            let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
            action.sa_sigaction = cancel as *const () as usize;
            if unsafe { libc::sigemptyset(&mut action.sa_mask) } != 0 {
                return Err("capture_signal_scope_unavailable");
            }
            let mut previous = std::mem::MaybeUninit::<libc::sigaction>::uninit();
            if unsafe { libc::sigaction(signal, &action, previous.as_mut_ptr()) } != 0 {
                return Err("capture_signal_scope_unavailable");
            }
            scope
                .previous
                .push((signal, unsafe { previous.assume_init() }));
        }
        Ok(scope)
    }
    pub fn cancelled(&self) -> Option<i32> {
        let signal = CANCELLED.load(std::sync::atomic::Ordering::Relaxed);
        (signal != 0).then_some(signal)
    }
}
impl Drop for CancellationScope {
    fn drop(&mut self) {
        for (signal, previous) in self.previous.iter().rev() {
            unsafe {
                libc::sigaction(*signal, previous, std::ptr::null_mut());
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn disposition(signal: libc::c_int) -> libc::sigaction {
        let mut action = std::mem::MaybeUninit::<libc::sigaction>::uninit();
        assert_eq!(
            unsafe { libc::sigaction(signal, std::ptr::null(), action.as_mut_ptr()) },
            0
        );
        unsafe { action.assume_init() }
    }
    #[test]
    fn cancellation_scope_is_exclusive_observable_and_restores_signal_dispositions() {
        let before = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP, libc::SIGQUIT].map(disposition);
        let scope = CancellationScope::open().unwrap();
        assert_eq!(scope.cancelled(), None);
        assert!(CancellationScope::open().is_err());
        cancel(libc::SIGTERM);
        cancel(libc::SIGINT);
        assert_eq!(scope.cancelled(), Some(libc::SIGTERM));
        drop(scope);
        for (signal, previous) in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP, libc::SIGQUIT]
            .into_iter()
            .zip(before)
        {
            let after = disposition(signal);
            assert_eq!(after.sa_sigaction, previous.sa_sigaction);
            // Linux libc may add its internal SA_RESTORER trampoline bit when
            // restoring a default disposition. Compare the public semantics.
            let public_flags = libc::SA_NOCLDSTOP
                | libc::SA_NOCLDWAIT
                | libc::SA_ONSTACK
                | libc::SA_RESTART
                | libc::SA_NODEFER
                | libc::SA_RESETHAND
                | libc::SA_SIGINFO;
            assert_eq!(
                after.sa_flags & public_flags,
                previous.sa_flags & public_flags
            );
            for masked in 1..=64 {
                assert_eq!(
                    unsafe { libc::sigismember(&after.sa_mask, masked) },
                    unsafe { libc::sigismember(&previous.sa_mask, masked) },
                );
            }
        }
        let next = CancellationScope::open().unwrap();
        assert_eq!(next.cancelled(), None);
    }
}

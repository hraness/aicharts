//! One process-global synthetic capture owner for the dormant HTTPS regressions.
//! The guard must outlive each server/socket join, including assertion unwinds.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, Once};

struct CaptureLogger(AtomicUsize);

impl log::Log for CaptureLogger {
    fn enabled(&self, _: &log::Metadata<'_>) -> bool {
        true
    }

    fn log(&self, _: &log::Record<'_>) {
        // Any record fails the regression; never format or retain its payload.
        self.0.fetch_add(1, Ordering::SeqCst);
    }

    fn flush(&self) {}
}

static CAPTURE: CaptureLogger = CaptureLogger(AtomicUsize::new(0));
static INSTALL: Once = Once::new();
static OWNER: Mutex<()> = Mutex::new(());

pub(crate) struct CaptureGuard {
    _owner: MutexGuard<'static, ()>,
}

pub(crate) fn capture() -> CaptureGuard {
    let owner = OWNER.lock().expect("synthetic capture owner");
    INSTALL.call_once(|| {
        log::set_logger(&CAPTURE).expect("synthetic logger must be installed once");
        log::set_max_level(log::LevelFilter::Trace);
    });
    assert_eq!(log::STATIC_MAX_LEVEL, log::LevelFilter::Off);
    assert_eq!(log::max_level(), log::LevelFilter::Trace);
    CAPTURE.0.store(0, Ordering::SeqCst);
    let probe = log::Record::builder()
        .args(format_args!("synthetic-log-sink-probe"))
        .level(log::Level::Trace)
        .target("aicharts.transport.synthetic")
        .build();
    assert!(log::logger().enabled(probe.metadata()));
    // Direct delivery bypasses the compile-time macro filter, proving the sink
    // is live before the real dependencies perform TLS exchange and cleanup.
    log::logger().log(&probe);
    assert_eq!(CAPTURE.0.swap(0, Ordering::SeqCst), 1);
    CaptureGuard { _owner: owner }
}

impl CaptureGuard {
    pub(crate) fn assert_empty(&self) {
        assert_eq!(
            CAPTURE.0.load(Ordering::SeqCst),
            0,
            "dependency logging must remain disabled through TLS exchange and cleanup"
        );
    }
}

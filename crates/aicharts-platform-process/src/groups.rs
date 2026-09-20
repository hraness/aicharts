//! Bounded macOS group membership for an unreaped, owned child leader.
const INVALID: &str = "capture_process_group_unavailable";

/// Prove that the kernel's complete group list contains only its leader.
/// The caller must separately retain and verify the exited child with WNOWAIT;
/// this read-only function does not establish ownership of a numeric PID.
pub fn contains_only_leader(group: i32) -> Result<bool, &'static str> {
    // Never inspect the inherited group as an owned capture group.
    if group <= 1 || group == unsafe { libc::getpgrp() } {
        return Err(INVALID);
    }
    let mut pids = [0i32; 4096];
    let capacity = std::mem::size_of_val(&pids);
    // PROC_PGRP_ONLY is defined as 2 in sys/proc_info.h. libproc returns bytes,
    // not a PID count, and can return zero on failure. Require the retained
    // leader itself, so an empty or failed query never proves quiescence.
    // SAFETY: this initialized, aligned output buffer is live for its full size.
    let bytes =
        unsafe { libc::proc_listpids(2, group as u32, pids.as_mut_ptr().cast(), capacity as i32) };
    only_leader(group, &pids, bytes)
}

fn only_leader(group: i32, pids: &[i32], bytes: i32) -> Result<bool, &'static str> {
    let bytes = usize::try_from(bytes).map_err(|_| INVALID)?;
    let width = std::mem::size_of::<i32>();
    if bytes == 0 || bytes >= std::mem::size_of_val(pids) || bytes % width != 0 {
        return Err(INVALID);
    }
    let members = &pids[..bytes / width];
    if members.iter().any(|pid| *pid <= 1) || !members.contains(&group) {
        return Err(INVALID);
    }
    Ok(members.len() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_a_complete_single_leader_list_proves_quiescence() {
        assert_eq!(only_leader(123, &[123, 0, 0], 4), Ok(true));
        assert_eq!(only_leader(123, &[123, 456, 0], 8), Ok(false));
        for (pids, bytes) in [
            ([123, 0, 0], 0),
            ([123, 0, 0], -1),
            ([123, 0, 0], 3),
            ([123, 0, 0], 12),
            ([456, 0, 0], 4),
            ([123, 0, 0], 8),
        ] {
            assert!(only_leader(123, &pids, bytes).is_err());
        }
        assert!(contains_only_leader(0).is_err());
        assert!(contains_only_leader(unsafe { libc::getpgrp() }).is_err());
    }
}

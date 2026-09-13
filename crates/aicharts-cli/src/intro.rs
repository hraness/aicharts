pub(crate) fn terminal_intro(
    is_terminal: bool,
    term: Option<&str>,
    columns: Option<usize>,
) -> &'static str {
    if !is_terminal || term == Some("dumb") || columns.unwrap_or(80) < 48 {
        return "";
    }
    "  |    /  AI Charts\n  | __/   Read local usage.\n  |/\n  +-----\n\n"
}

#[cfg(test)]
mod tests {
    use super::terminal_intro;

    #[test]
    fn interactive_intro_preserves_plain_terminal_modes() {
        let intro = terminal_intro(true, Some("xterm-256color"), Some(80));
        assert!(intro.contains("AI Charts"));
        assert!(intro
            .bytes()
            .all(|byte| byte == b'\n' || (0x20..=0x7e).contains(&byte)));
        assert_eq!(terminal_intro(false, Some("xterm"), Some(80)), "");
        assert_eq!(terminal_intro(true, Some("dumb"), Some(80)), "");
        assert_eq!(terminal_intro(true, Some("xterm"), Some(47)), "");
    }
}

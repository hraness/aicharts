//! Explicit MiniMax Code execution with a private numeric-only capture.
//! This path is never called by local stats reads or scheduled publication.
use std::{path::PathBuf, time::Duration};

#[cfg(unix)]
mod process;
mod projection;
#[cfg(test)]
mod tests;

pub(crate) struct Outcome {
    pub(crate) summary: String,
    pub(crate) exit_code: i32,
}
type Result<T> = std::result::Result<T, &'static str>;
const MAX_BYTES: usize = 64 * 1024 * 1024;
const USAGE: &str = "capture_usage";
struct Options {
    cache: PathBuf,
    executable: PathBuf,
    args: Vec<String>,
    timeout: Duration,
}
fn options(args: &[String]) -> Result<Options> {
    if args.first().map(String::as_str) != Some("mcode")
        || args.len() > 264
        || args
            .iter()
            .try_fold(0usize, |sum, value| sum.checked_add(value.len() + 1))
            .is_none_or(|total| total > 65_536)
    {
        return Err(USAGE);
    }
    let mut cache = None;
    let mut executable = None;
    let mut seconds = None;
    let mut index = 1;
    while index < args.len() && args[index] != "--" {
        let value = args.get(index + 1).ok_or(USAGE)?;
        match args[index].as_str() {
            "--cache-dir" if cache.is_none() => cache = Some(PathBuf::from(value)),
            "--executable" if executable.is_none() => executable = Some(PathBuf::from(value)),
            "--timeout-seconds" if seconds.is_none() => {
                if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(USAGE);
                }
                let parsed = value.parse::<u64>().map_err(|_| USAGE)?;
                if !(1..=7200).contains(&parsed) {
                    return Err(USAGE);
                }
                seconds = Some(parsed);
            }
            _ => return Err(USAGE),
        }
        index += 2;
    }
    if args.get(index).map(String::as_str) != Some("--") {
        return Err(USAGE);
    }
    let cache = cache.ok_or(USAGE)?;
    let executable = executable.ok_or(USAGE)?;
    if !cache.is_absolute() || !executable.is_absolute() {
        return Err(USAGE);
    }
    let args = prepare_args(&args[index + 1..])?;
    Ok(Options {
        cache,
        executable,
        args,
        timeout: Duration::from_secs(seconds.unwrap_or(3600)),
    })
}
fn prepare_args(args: &[String]) -> Result<Vec<String>> {
    if args.first().map(String::as_str) != Some("exec")
        || args.len() > 256
        || args.iter().any(|v| v.contains('\0'))
        || args
            .iter()
            .try_fold(0usize, |sum, v| sum.checked_add(v.len() + 1))
            .is_none_or(|n| n > 65536)
    {
        return Err(USAGE);
    }
    let mut format = false;
    let mut index = 1;
    while index < args.len() && args[index] != "--" {
        let arg = &args[index];
        if arg == "--output-format" || arg == "--format" {
            if format || args.get(index + 1).map(String::as_str) != Some("stream-json") {
                return Err("capture_format_required");
            }
            format = true;
            index += 1;
        } else if arg.starts_with("--output-format=") || arg.starts_with("--format=") {
            if format || arg.split_once('=').map(|(_, value)| value) != Some("stream-json") {
                return Err("capture_format_required");
            }
            format = true;
        }
        index += 1;
    }
    let mut result = args.to_vec();
    if !format {
        result.splice(1..1, ["--output-format".into(), "stream-json".into()]);
    }
    if result.len() > 256 || result.iter().map(|value| value.len() + 1).sum::<usize>() > 65_536 {
        return Err(USAGE);
    }
    Ok(result)
}

pub(crate) fn run(args: &[String]) -> Result<Outcome> {
    if args == ["--help"]
        || args == ["-h"]
        || args == ["mcode", "--help"]
        || args == ["mcode", "-h"]
    {
        return Ok(Outcome { exit_code: 0, summary: "Usage: aicharts capture mcode --cache-dir ABS --executable ABS [--timeout-seconds 1..7200] -- exec [mcode arguments...]\n\nRuns your explicit mcode executable with stream-json output. AI Charts stores only numeric usage from completed, successful turns in a private cache; this command never publishes it. Read it later with stats --client mcode --source-root ABS.\n\nArguments pass directly to mcode without a shell. An existing output format must be stream-json. Child stdout and stderr are consumed privately, not echoed or saved. The default timeout is 3600 seconds; bounds are 64 MiB stdout, 4 MiB stderr, and 64 MiB retained numeric history. Failed, incomplete, canceled, or oversized captures preserve previous history. Use a separate cache if the executable identity changes.\n".into() });
    }
    let options = options(args)?;
    #[cfg(unix)]
    {
        process::capture(&options)
    }
    #[cfg(not(unix))]
    {
        let _ = options;
        Err("capture_platform_unavailable")
    }
}

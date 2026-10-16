/**
 * Print always uses the light theme: paper is white, and printing a dark theme would put
 * light text on it (browsers drop backgrounds but keep text colours). The values mirror the
 * light `:root` tokens in globals.css; `:root:root` outranks the dark-scheme block whatever
 * order the stylesheets load in. Screen rendering is unaffected.
 */
const PRINT_CSS = `@media print {
  :root:root {
    color-scheme: light;
    --bg: #ffffff;
    --panel: #ffffff;
    --panel-2: #eef0f3;
    --line: #dfe3e8;
    --ink: #12151a;
    --ink-2: #454c57;
    --ink-3: #79818d;
    --accent: #4f46e5;
    --accent-ink: #ffffff;
    --accent-soft: #e8e7fd;
    --good: #1f9d55;
    --warn: #c27c0e;
    --bad: #d93a3a;
    --shadow: none;
  }
  @page {
    margin: 14mm 12mm;
  }
}`;

/** React hoists this stylesheet into <head> once (deduplicated by href). */
export function PrintStyles() {
  return (
    <style href="gd-arena-print-theme" precedence="default">
      {PRINT_CSS}
    </style>
  );
}

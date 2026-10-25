/**
 * The app's backdrop: three soft colour fields drifting slowly behind everything, over a faint
 * dot grid that fades out down the page. Decorative; static with reduced motion. Gradients
 * (not blur filters) keep it cheap on phones.
 */
export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden">
      <div
        className="aurora-blob absolute -left-[12%] -top-[18%] size-[60vmax] rounded-full"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--accent) 24%, transparent), transparent)" }}
      />
      <div
        className="aurora-blob absolute -right-[18%] top-[6%] size-[52vmax] rounded-full [animation-delay:-9s]"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, #ec4899 16%, transparent), transparent)" }}
      />
      <div
        className="aurora-blob absolute -bottom-[22%] left-[22%] size-[55vmax] rounded-full [animation-delay:-16s]"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, #14b8a6 14%, transparent), transparent)" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(var(--line)_1px,transparent_1px)] bg-size-[22px_22px] opacity-50 mask-[linear-gradient(to_bottom,black,transparent_70%)]" />
    </div>
  );
}

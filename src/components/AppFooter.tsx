import { InstallButton } from "./install/InstallButton";

/** The credit line, and the install button where the app can be installed. */
export function AppFooter() {
  return (
    <footer className="border-t border-line/70 bg-panel/50 backdrop-blur-sm print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-ink-2 sm:flex-row sm:px-6">
        <p className="text-center">
          Made by <span className="font-semibold text-ink">Pranay</span> with{" "}
          <span className="bg-linear-to-r from-accent to-accent-2 bg-clip-text font-semibold text-transparent forced-colors:bg-none forced-colors:text-[CanvasText]">
            Claude
          </span>
        </p>
        <InstallButton />
      </div>
    </footer>
  );
}

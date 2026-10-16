"use client";

import { Check, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { transcriptFileName, transcriptToText } from "@/lib/transcript-text";
import type { GDRecord } from "@/lib/types";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { downloadText } from "./download";
import { formatDateLabel } from "./format";

/** How long the button shows its "saved" tick after a download. */
const SAVED_MS = 2_500;

interface DownloadTranscriptButtonProps extends Pick<ButtonProps, "variant" | "size" | "className"> {
  record: GDRecord;
  /** When the GD took place (dates the header and the file name). */
  date: Date;
}

/** "Download transcript (.txt)": the whole GD as plain text, with brief confirmation. */
export function DownloadTranscriptButton({ record, date, ...buttonProps }: DownloadTranscriptButtonProps) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), SAVED_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function handleClick() {
    const text = transcriptToText(record, { dateLabel: formatDateLabel(date) });
    downloadText(transcriptFileName(record.config.topic.title, date), text);
    setSaved(true);
  }

  return (
    <>
      <Button
        {...buttonProps}
        onClick={handleClick}
        icon={
          saved ? (
            <Check aria-hidden className="size-4 text-good" />
          ) : (
            <Download aria-hidden className="size-4" />
          )
        }
      >
        Download transcript (.txt)
      </Button>
      <span className="sr-only" aria-live="polite">
        {saved ? "Transcript downloaded." : ""}
      </span>
    </>
  );
}

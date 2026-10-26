import { Progress, Spinner } from './kit';

/** Blocking progress overlay for imports/exports, announced to screen readers. */
export function BusyOverlay({ title, detail, progress }: { title: string; detail?: string; progress?: number | null }) {
  return (
    <div className="busy" role="alertdialog" aria-modal="true" aria-label={title} aria-busy="true">
      <div className="panel busy__card">
        <Spinner large label={title} />
        <div className="busy__title">{title}</div>
        {detail && <div className="busy__detail ellipsis">{detail}</div>}
        {progress !== undefined && progress !== null && <Progress value={progress} label={title} />}
      </div>
    </div>
  );
}

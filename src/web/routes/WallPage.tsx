import { useParams } from 'react-router-dom';

/** Placeholder — the real wall grid/rotation/liquid-fill UI lands in later Phase 3 tasks. */
export function WallPage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <p>Wall &ldquo;{slug}&rdquo; is warming up.</p>
    </main>
  );
}

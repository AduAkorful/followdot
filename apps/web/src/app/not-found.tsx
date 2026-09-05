import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <p className="text-sm uppercase tracking-widest text-[var(--accent)] font-semibold mb-3">
        404
      </p>
      <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
        Page not found
      </h1>
      <p className="text-[var(--text-secondary)] max-w-md mb-8">
        That route does not exist in Followdot. Head back to the leaderboard to
        browse live whale scores from the DreamDEX indexer.
      </p>
      <Link href="/" className="btn btn-accent">
        Back to Leaderboard
      </Link>
    </div>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>Page not found</h1>
        <Link href="/dashboard" className="btn btn-primary">
          Go to dashboard
        </Link>
      </section>
    </main>
  );
}

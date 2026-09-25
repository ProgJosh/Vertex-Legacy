export default function Loading() {
  return (
    <main className="container public-page" aria-busy="true" aria-label="Loading">
      <div className="skeleton" />
      <div className="skeleton" style={{ marginTop: 16 }} />
      <div className="skeleton" style={{ marginTop: 16 }} />
    </main>
  );
}

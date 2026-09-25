import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="container public-page">
      <p className="eyebrow">404</p>
      <h1>That page is not available.</h1>
      <p className="muted">Check the address or return to the Vertex Legacy overview.</p>
      <Button asChild>
        <Link href="/">Return home</Link>
      </Button>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="Vertex Legacy home">
      <Image src="/logo.jfif" width={42} height={42} alt="" priority />
      <span>
        <strong>Vertex Legacy</strong>
        <span>Investment operations</span>
      </span>
    </Link>
  );
}

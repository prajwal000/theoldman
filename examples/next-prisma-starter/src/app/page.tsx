import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>Shop</h1>
      <p>
        <Link href="/orders">Your orders</Link>
      </p>
    </main>
  );
}

import OneOnOneDetailClient from './OneOnOneDetailClient';

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function OneOnOneDetailPage() {
  return <OneOnOneDetailClient />;
}

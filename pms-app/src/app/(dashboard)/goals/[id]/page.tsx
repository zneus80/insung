import GoalDetailClient from './GoalDetailClient';

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function GoalDetailPage() {
  return <GoalDetailClient />;
}

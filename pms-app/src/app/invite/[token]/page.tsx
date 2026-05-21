import InviteClient from './InviteClient';

export function generateStaticParams() {
  return [{ token: '_' }];
}

export default function InvitePage() {
  return <InviteClient />;
}

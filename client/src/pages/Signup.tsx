import { Link } from 'wouter';
export default function Signup() {
 return <main className="min-h-screen flex items-center justify-center bg-muted p-6"><section className="max-w-md rounded-lg border bg-background p-6 space-y-4"><h1 className="text-xl font-semibold">Contact HR for an account</h1><p>Self-registration is disabled. Your administrator creates your account and HR provides your sign-in details.</p><Link href="/login" className="text-primary underline">Return to sign in</Link></section></main>;
}

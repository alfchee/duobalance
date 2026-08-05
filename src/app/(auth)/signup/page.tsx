import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>Auth flow lands in #14.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <p>Placeholder screen — wired up by issue #14.</p>
      </CardContent>
    </Card>
  );
}

interface Greeting {
  text: string;
}

export function formatGreeting(name: string): string {
  const greeting: Greeting = { text: `hello ${name}` };
  return greeting.text;
}

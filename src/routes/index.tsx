import { createFileRoute } from "@tanstack/react-router";
import { Narrivox } from "@/components/nightstand";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Narrivox />;
}

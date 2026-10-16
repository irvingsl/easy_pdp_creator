import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Easy PDP Creator",
    short_name: "PDP Creator",
    start_url: "/produtos",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111827",
  };
}

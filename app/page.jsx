import ErrorBoundary from "@/components/ErrorBoundary";
import Studio        from "@/components/Studio";

// All rendering happens client-side inside Studio.
// This server component is intentionally minimal.
export default function Page() {
  return (
    <ErrorBoundary>
      <Studio />
    </ErrorBoundary>
  );
}

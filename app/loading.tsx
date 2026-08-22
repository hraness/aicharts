import { HomeDocument } from "@/components/home-document";
import { RouteLoadingState } from "@/components/route-state";

export default function Loading() {
  return (
    <>
      <HomeDocument />
      <RouteLoadingState />
    </>
  );
}

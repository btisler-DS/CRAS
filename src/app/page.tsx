import { RuntimeDashboard } from "../components/runtime-dashboard.js";
import { getRuntimeSession } from "../server/runtime-session.js";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <RuntimeDashboard initialView={getRuntimeSession().view()} />;
}

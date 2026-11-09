import ReactDOM from "react-dom/client";
import { AppBootstrap } from "./app/AppBootstrap";
import { startOptionalUsageAnalytics } from "./analytics/optionalUsageAnalytics";
import "./styles.css";

startOptionalUsageAnalytics();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root element was not found.");
}

ReactDOM.createRoot(root).render(<AppBootstrap />);

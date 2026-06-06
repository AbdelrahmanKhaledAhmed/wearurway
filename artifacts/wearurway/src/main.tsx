import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import {
  flushQueuedOrders,
  registerOrderServiceWorker,
} from "./lib/order-queue";

createRoot(document.getElementById("root")!).render(<App />);

void registerOrderServiceWorker();
void flushQueuedOrders();

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flushQueuedOrders();
  });
}

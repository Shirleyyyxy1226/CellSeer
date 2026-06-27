import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "@/lib/api/authToken";
import { installFetchInterceptor } from "@/lib/api/fetchInterceptor";

installFetchInterceptor();

createRoot(document.getElementById("root")!).render(<App />);

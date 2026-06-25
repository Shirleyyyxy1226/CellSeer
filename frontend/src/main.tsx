import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/authToken";
import { installFetchInterceptor } from "./lib/fetchInterceptor";

installFetchInterceptor();

createRoot(document.getElementById("root")!).render(<App />);

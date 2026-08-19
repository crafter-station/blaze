import { dokployGet } from "./client";
import type { MonitoringData } from "./types";

export async function getAppMonitoring(appName: string): Promise<MonitoringData> {
	return dokployGet<MonitoringData>("application.readAppMonitoring", { appName });
}

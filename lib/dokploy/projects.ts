import { dokployGet } from "./client";
import type { Project, ProjectSummary } from "./types";

export async function getAllProjects(): Promise<ProjectSummary[]> {
	return dokployGet<ProjectSummary[]>("project.all");
}

export async function getProject(projectId: string): Promise<Project> {
	return dokployGet<Project>("project.one", { projectId });
}

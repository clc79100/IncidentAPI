import { IncidentType } from "../enums/incident-type.enum";


//DTO
export interface IncidentCDto {
  title: string;
  description: string;
  lat: number;
  lon: number;
  type: IncidentType
}

// API ChatGPT enums!! magic String!!
// 1 Mes Claude Code 17 Dolares!

import { Injectable } from '@nestjs/common';
import { IncidentCDto } from 'src/core/interfaces/incident.interface';
import { EmailOptions } from 'src/core/interfaces/mail-options.interface';
import { EmailService } from 'src/email/email.service';
import { generateIncidentEmailTemplate } from './templates/incident-email.template';
import { Repository } from 'typeorm';
import { Incident } from 'src/core/db/entities/incident.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { logger } from 'src/config/logger';
// npm run start:dev
// Repositorio --> Patron de diseño Repository
@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentRepository: Repository<Incident>,
    private readonly emailService: EmailService
  ) { }

  async createIncident(incident: IncidentCDto): Promise<Boolean> {
    // Se crea entidad de Incident
    // Se guarda en DB
    const newIncident = this.incidentRepository.create({
      title: incident.title,
      description: incident.description,
      type: incident.type,
      location: {
        type: 'Point',
        coordinates: [incident.lon, incident.lat]
      }
    });
    await this.incidentRepository.save(newIncident);
    const template = generateIncidentEmailTemplate(incident);
    const options: EmailOptions = {
      to: "clchavezc.56@gmail.com",
      subject: incident.title,
      html: template
    }
    const result = await this.emailService.sendEmail(options);
    return result;
  }

  async getIncidents() : Promise<Incident[]> {
    try {
      //Cloud watch / App Insights txt
      // - Memory leaks
      //https://snyk.io/es/: detecta vulnerabilidades, como hardcoder
      logger.info("[IncidentService] Trayeron todos los incidentes");
      const incidents = await this.incidentRepository.find();
      logger.info(`[IncidentService] se obtuvieron ${incidents.length} incidents`);
      return incidents;
    } catch (error) {
      console.error("[IncidentService] Error al traer los incidents")
      return [];
    }
  }

  async getIncidentByRadius(lat:number, lon:number, radius:number) : Promise<Incident[]>{
    try {
      logger.info(`Buscando incidentes en ${lat} ${lon} en un radio de ${radius} mts`);
      const incidents = await this.incidentRepository
        .createQueryBuilder('incident')
        .where(`
          ST_DWithin(
            incident.location::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :radius
          )
        `, { lon, lat, radius })
      .getMany();
      logger.info(`Se encontraron ${incidents.length} en un radio de ${radius} mts`);
      return incidents;

    } catch (error) {
      console.error(error);
      return [];
    }
  }
}

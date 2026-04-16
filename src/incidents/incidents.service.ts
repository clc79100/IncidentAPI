import { Injectable } from '@nestjs/common';
import { IncidentCDto } from 'src/core/interfaces/incident.interface';
import { EmailOptions } from 'src/core/interfaces/mail-options.interface';
import { EmailService } from 'src/email/email.service';
import { generateIncidentEmailTemplate } from './templates/incident-email.template';
import { Repository } from 'typeorm';
import { Incident } from 'src/core/db/entities/incident.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { logger } from 'src/config/logger';
import Redis from 'ioredis';
import { envs } from 'src/config/envs';
import { CacheService } from 'src/cache/cache.service';

// npm run start:dev
//Repositorio --> Patron de Diseño Repository JWT - Redis - PDF - AppInsights

const CACHE_KEY_ALL_INCIDENTS = 'incidents:all';

@Injectable()
export class IncidentsService {
    constructor(
        @InjectRepository(Incident)
        private readonly incidentRepository : Repository<Incident>,
        private readonly emailService : EmailService,
        private readonly cacheService : CacheService
    ){}
// Cloud Watch / App Insights txt / Keyvault
// logger.info
    private readonly redis = new Redis({
        host:envs.REDIS_HOST,
        port:envs.REDIS_PORT
    });

    async getIncidentByRadius(lat:number,lon:number,radius:number) : Promise<Incident[]>{
        //SP
        try{
            logger.info(`Buscando incidentes en ${lat}, ${lon} en un radio de ${radius} m`)
            const incidents = await this.incidentRepository
                    .createQueryBuilder('incident')
                    .where(`
                       ST_DWithin(
                        incident.location::geography,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                        :radius
                    )    
                    `,{ lon,lat,radius })
                    .getMany();
            logger.info(`${incidents} incidentes encontrados en un radio de ${radius} m`)
            return incidents;
        }
        catch(error){
            console.error(error);
            return [];
        }
    }

    async getIncidents() : Promise<Incident[]>{
        try{
            logger.info("[IncidentService] Consultando incidentes en cache...");
            const data = await this.cacheService.get<Incident[]>(CACHE_KEY_ALL_INCIDENTS);
            
            if(data && data.length > 0){
                logger.info("[IncidentService] Incidentes en cache")
                return data;
            }
            //JSON.PARSE
            //JSON.stringify
            logger.info("[IncidentService] Trayendo todos los incidentes...");
            const incidents = await this.incidentRepository.find();
            logger.info("[IncidentService] Guardando incidentes en cache");
            const incidentsString = JSON.stringify(incidents);
            this.redis.set(CACHE_KEY_ALL_INCIDENTS,incidentsString)
            logger.info(`[IncidentService] Se obtuvieron ${incidents.length} incidentes`)
            return incidents;
        }
        catch(error){
            console.error("[IncidentService] Error al traer los incidentes");
            console.error(error);
            return [];
        }
        
    }

    async createIncident(incident:IncidentCDto) : Promise<Boolean>{
        // UNA ENTIDAD DE INICIDENTE
        // GUARDAS EN DB
        const newIncident = this.incidentRepository.create({
            title: incident.title,
            description: incident.description,
            type: incident.type,
            location:{
                type: 'Point',
                coordinates:[incident.lon, incident.lat]
            }
        });
        logger.info("Creando Incidente");
        await this.incidentRepository.save(newIncident);
        await this.cacheService.delete(CACHE_KEY_ALL_INCIDENTS);
        logger.info("Mandando correo");
        const template = generateIncidentEmailTemplate(incident);
        const options : EmailOptions = {
            to: "devjdfr@gmail.com",
            subject: incident.title,
            html: template
        }
        const result = await this.emailService.sendEmail(options);
        return result;
    }
}
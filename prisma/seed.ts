import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL no está definida.');
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

type SeedBusinessModule = {
  moduleKey: string;
  enabled: boolean;
  config?: Prisma.InputJsonValue;
};

async function main() {
  console.log('🌱 Iniciando seed...');

  /* ─────────────────────────────────────────────
     1. BUSINESS
  ───────────────────────────────────────────── */

  const business = await prisma.business.upsert({
    where: {
      slug: 'barberia-demo',
    },
    update: {
      name: 'Barbería Demo',
      businessType: 'barberia',
      timezone: 'America/Mexico_City',
      status: 'ACTIVE',
      plan: 'AGENDA',
    },
    create: {
      name: 'Barbería Demo',
      slug: 'barberia-demo',
      businessType: 'barberia',
      timezone: 'America/Mexico_City',
      status: 'ACTIVE',
      plan: 'AGENDA',
    },
  });

  console.log(`✅ Business creado/actualizado: ${business.name}`);

  /* ─────────────────────────────────────────────
     2. BUSINESS CONFIG
  ───────────────────────────────────────────── */

  const mainMenuConfig: Prisma.InputJsonValue = {
    options: [
      {
        number: 1,
        label: 'Agendar una cita',
        action: 'APPOINTMENT',
        enabled: true,
      },
      {
        number: 2,
        label: 'Consultar servicios y precios',
        action: 'FAQ_SERVICES',
        enabled: true,
      },
      {
        number: 3,
        label: 'Resolver dudas frecuentes',
        action: 'FAQ',
        enabled: true,
      },
      {
        number: 4,
        label: 'Dejar una solicitud',
        action: 'REQUEST',
        enabled: true,
      },
      {
        number: 5,
        label: 'Hablar con una persona',
        action: 'HUMAN_HANDOFF',
        enabled: true,
      },
    ],
  };

  const businessHoursConfig: Prisma.InputJsonValue = {
    monday: {
      enabled: true,
      start: '09:00',
      end: '18:00',
    },
    tuesday: {
      enabled: true,
      start: '09:00',
      end: '18:00',
    },
    wednesday: {
      enabled: true,
      start: '09:00',
      end: '18:00',
    },
    thursday: {
      enabled: true,
      start: '09:00',
      end: '18:00',
    },
    friday: {
      enabled: true,
      start: '09:00',
      end: '18:00',
    },
    saturday: {
      enabled: true,
      start: '09:00',
      end: '15:00',
    },
    sunday: {
      enabled: false,
    },
  };

  const paymentMethods: Prisma.InputJsonValue = [
    'Efectivo',
    'Tarjeta',
    'Transferencia',
  ];

  await prisma.businessConfig.upsert({
    where: {
      businessId: business.id,
    },
    update: {
      welcomeMessage:
        'Hola 👋 Bienvenido a Barbería Demo.\n\nSoy el asistente virtual y puedo ayudarte con lo siguiente:',
      humanHandoffMessage:
        'Claro, puedo canalizarte con una persona del equipo. Cuéntame brevemente el motivo de tu consulta.',
      fallbackMessage:
        'No logré entender tu respuesta 😅. Intenta nuevamente o escribe "menú" para volver al inicio.',
      mainMenuConfig,
      businessHoursConfig,
      paymentMethods,
      locationText: 'Av. Principal 123, Col. Centro',
      googleMapsUrl: 'https://maps.google.com/',
      cancellationPolicy:
        'Las cancelaciones deben realizarse con al menos 2 horas de anticipación.',
      maxFailedAttempts: 2,
      sessionExpirationMinutes: 60,
    },
    create: {
      businessId: business.id,
      welcomeMessage:
        'Hola 👋 Bienvenido a Barbería Demo.\n\nSoy el asistente virtual y puedo ayudarte con lo siguiente:',
      humanHandoffMessage:
        'Claro, puedo canalizarte con una persona del equipo. Cuéntame brevemente el motivo de tu consulta.',
      fallbackMessage:
        'No logré entender tu respuesta 😅. Intenta nuevamente o escribe "menú" para volver al inicio.',
      mainMenuConfig,
      businessHoursConfig,
      paymentMethods,
      locationText: 'Av. Principal 123, Col. Centro',
      googleMapsUrl: 'https://maps.google.com/',
      cancellationPolicy:
        'Las cancelaciones deben realizarse con al menos 2 horas de anticipación.',
      maxFailedAttempts: 2,
      sessionExpirationMinutes: 60,
    },
  });

  console.log('✅ BusinessConfig creado/actualizado');

  /* ─────────────────────────────────────────────
     3. BUSINESS MODULES
  ───────────────────────────────────────────── */

  const modules: SeedBusinessModule[] = [
    {
      moduleKey: 'MAIN_MENU',
      enabled: true,
    },
    {
      moduleKey: 'FAQ',
      enabled: true,
    },
    {
      moduleKey: 'APPOINTMENT',
      enabled: true,
      config: {
        allowNotes: true,
        maxDaysAhead: 30,
        slotIntervalMinutes: 30,
        bufferMinutes: 0,
      },
    },
    {
      moduleKey: 'REQUEST',
      enabled: true,
    },
    {
      moduleKey: 'HUMAN_HANDOFF',
      enabled: true,
    },
    {
      moduleKey: 'GOOGLE_SHEETS',
      enabled: false,
    },
    {
      moduleKey: 'GOOGLE_CALENDAR',
      enabled: false,
    },
  ];

  for (const moduleItem of modules) {
    await prisma.businessModule.upsert({
      where: {
        businessId_moduleKey: {
          businessId: business.id,
          moduleKey: moduleItem.moduleKey,
        },
      },
      update: {
        enabled: moduleItem.enabled,
        config: moduleItem.config,
      },
      create: {
        businessId: business.id,
        moduleKey: moduleItem.moduleKey,
        enabled: moduleItem.enabled,
        config: moduleItem.config,
      },
    });
  }

  console.log('✅ BusinessModules creados/actualizados');

  /* ─────────────────────────────────────────────
     4. SERVICES
  ───────────────────────────────────────────── */

  const services = [
    {
      name: 'Corte de cabello',
      description: 'Corte clásico o moderno',
      price: 150,
      durationMinutes: 30,
      sortOrder: 1,
    },
    {
      name: 'Barba',
      description: 'Perfilado y arreglo de barba',
      price: 100,
      durationMinutes: 20,
      sortOrder: 2,
    },
    {
      name: 'Corte + barba',
      description: 'Servicio combinado de corte y barba',
      price: 220,
      durationMinutes: 50,
      sortOrder: 3,
    },
  ];

  for (const service of services) {
    const existingService = await prisma.service.findFirst({
      where: {
        businessId: business.id,
        name: service.name,
      },
    });

    if (existingService) {
      await prisma.service.update({
        where: {
          id: existingService.id,
        },
        data: {
          description: service.description,
          price: service.price,
          durationMinutes: service.durationMinutes,
          enabled: true,
          sortOrder: service.sortOrder,
        },
      });
    } else {
      await prisma.service.create({
        data: {
          businessId: business.id,
          name: service.name,
          description: service.description,
          price: service.price,
          durationMinutes: service.durationMinutes,
          enabled: true,
          sortOrder: service.sortOrder,
        },
      });
    }
  }

  console.log('✅ Services creados/actualizados');

  /* ─────────────────────────────────────────────
     5. FAQ ITEMS
  ───────────────────────────────────────────── */

  const faqItems = [
    {
      category: 'Horarios',
      question: '¿Cuál es el horario de atención?',
      answer:
        'Nuestro horario es de lunes a viernes de 9:00 a 18:00 y sábados de 9:00 a 15:00.',
      keywords: ['horario', 'horarios', 'hora', 'abren', 'cierran'],
      sortOrder: 1,
    },
    {
      category: 'Ubicación',
      question: '¿Dónde están ubicados?',
      answer:
        'Estamos ubicados en Av. Principal 123, Col. Centro. Puedes consultar nuestra ubicación en Google Maps.',
      keywords: [
        'ubicacion',
        'ubicación',
        'direccion',
        'dirección',
        'donde',
        'dónde',
        'mapa',
      ],
      sortOrder: 2,
    },
    {
      category: 'Pagos',
      question: '¿Qué métodos de pago aceptan?',
      answer: 'Aceptamos efectivo, tarjeta y transferencia bancaria.',
      keywords: ['pago', 'pagos', 'tarjeta', 'efectivo', 'transferencia'],
      sortOrder: 3,
    },
    {
      category: 'Cancelaciones',
      question: '¿Cuál es la política de cancelación?',
      answer:
        'Las cancelaciones deben realizarse con al menos 2 horas de anticipación.',
      keywords: ['cancelar', 'cancelacion', 'cancelación', 'cambiar cita'],
      sortOrder: 4,
    },
    {
      category: 'Servicios',
      question: '¿Qué servicios ofrecen?',
      answer:
        'Ofrecemos corte de cabello, arreglo de barba y servicio combinado de corte + barba.',
      keywords: [
        'servicios',
        'servicio',
        'precio',
        'precios',
        'corte',
        'barba',
      ],
      sortOrder: 5,
    },
  ];

  for (const faq of faqItems) {
    const existingFaq = await prisma.faqItem.findFirst({
      where: {
        businessId: business.id,
        question: faq.question,
      },
    });

    if (existingFaq) {
      await prisma.faqItem.update({
        where: {
          id: existingFaq.id,
        },
        data: {
          category: faq.category,
          answer: faq.answer,
          keywords: faq.keywords,
          sortOrder: faq.sortOrder,
          enabled: true,
        },
      });
    } else {
      await prisma.faqItem.create({
        data: {
          businessId: business.id,
          category: faq.category,
          question: faq.question,
          answer: faq.answer,
          keywords: faq.keywords,
          sortOrder: faq.sortOrder,
          enabled: true,
        },
      });
    }
  }

  console.log('✅ FAQ items creados/actualizados');

  /* ─────────────────────────────────────────────
     6. SUMMARY
  ───────────────────────────────────────────── */

  const [moduleCount, serviceCount, faqCount] = await Promise.all([
    prisma.businessModule.count({
      where: {
        businessId: business.id,
      },
    }),
    prisma.service.count({
      where: {
        businessId: business.id,
      },
    }),
    prisma.faqItem.count({
      where: {
        businessId: business.id,
      },
    }),
  ]);

  console.log('');
  console.log('────────────────────────────────────');
  console.log('🌱 Seed finalizado correctamente');
  console.log('────────────────────────────────────');
  console.log(`Negocio: ${business.name}`);
  console.log(`Plan: ${business.plan}`);
  console.log(`Módulos: ${moduleCount}`);
  console.log(`Servicios: ${serviceCount}`);
  console.log(`FAQs: ${faqCount}`);
  console.log('────────────────────────────────────');
}

main()
  .catch((error) => {
    console.error('');
    console.error('❌ Error ejecutando seed:');
    console.error(error);

    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

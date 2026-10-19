import type {
  Conversation,
  ConversationSession,
  Customer,
  Message,
} from '@prisma/client';

export type FlowContext = {
  correlationId: string;

  businessId: string;
  customerId: string;
  conversationId: string;

  customer: Customer;
  conversation: Conversation;

  session: ConversationSession | null;

  /**
   * Mensaje INBOUND ya persistido.
   */
  message?: Message;

  /**
   * Contenido normalizado recibido por el motor.
   */
  input: {
    text?: string;

    interactiveId?: string;

    messageType: string;
  };
};

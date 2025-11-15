/**
 * Communication Module
 *
 * Exports message bus, transports, types, and utilities for hub-agent communication.
 */

export { MessageBus, ChannelNames, MessageIdGenerator } from './messageBus';
export { RedisPubSub } from './redisPubSub';
export { FileMessaging } from './fileMessaging';
export {
  Message,
  MessageType,
  MessagePriority,
  MessageHandler,
  IMessageBus,
  IMessageTransport,
  MessageBusConfig,
  MessageBusStats,
  TransportStats,
  DEFAULT_MESSAGE_BUS_CONFIG,
  QueuedMessage,
  MessageDeliveryResult,
} from './types';

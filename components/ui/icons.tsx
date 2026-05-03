// components/ui/icons.tsx
import {
  Plus, Search, MessageSquare, History, Star, Settings, User,
  ChevronDown, ChevronRight, X as Close, Copy, RotateCcw as Refresh,
  ThumbsUp, ThumbsDown, Edit, Trash2 as Trash, Bookmark, Pin, Sparkles as Sparkle,
  Mic, Paperclip, ArrowUp, Square as Stop, Wrench, Gauge, Zap as Bolt,
  FileText as Doc, Car, Check, LogOut as Logout, Menu,
} from "lucide-react";

export const I = {
  Plus, Search, Chat: MessageSquare, History, Star, Settings, User,
  ChevronDown, ChevronRight, Close, Copy, Refresh, ThumbsUp, ThumbsDown,
  Edit, Trash, Bookmark, Pin, Sparkle, Mic, Paperclip, ArrowUp, Stop,
  Wrench, Gauge, Bolt, Doc, Car, Check, Logout, Menu,
};

export type IconName = keyof typeof I;

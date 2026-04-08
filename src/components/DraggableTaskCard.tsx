"use client";

import { useState, type ReactNode } from "react";

interface DraggableTaskCardProps {
  taskId: string;
  status: string;
  children: ReactNode;
}

export default function DraggableTaskCard({ taskId, status, children }: DraggableTaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/task-id", taskId);
    e.dataTransfer.setData("text/from-status", status);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`cursor-grab active:cursor-grabbing transition-opacity ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {children}
    </div>
  );
}

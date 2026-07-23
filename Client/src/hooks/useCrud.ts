import { useState } from 'react';

export function useCrud<T extends { id?: number | string }>(initialItems: T[]) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<T | null>(null);

  const handleAddClick = () => {
    setSelectedItem(null);
    setIsFormOpen(true);
  };

  const handleEditClick = (item: T) => {
    setSelectedItem(item);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (item: T) => {
    setSelectedItem(item);
    setIsAlertOpen(true);
  };

  const handleSave = (data: T) => {
    const id = (data as any).id;
    if (id) {
      setItems((prev) => prev.map((i) => (i as any).id === id ? data : i));
    } else {
      setItems((prev) => [...prev, { ...data, id: Date.now() } as T]);
    }
  };

  const handleConfirmDelete = () => {
    if (selectedItem) {
      setItems((prev) => prev.filter((i) => (i as any).id !== (selectedItem as any).id));
      setIsAlertOpen(false);
      setSelectedItem(null);
    }
  };

  return {
    items,
    setItems,
    isFormOpen,
    setIsFormOpen,
    isAlertOpen,
    setIsAlertOpen,
    selectedItem,
    setSelectedItem,
    handleAddClick,
    handleEditClick,
    handleDeleteClick,
    handleSave,
    handleConfirmDelete,
  };
}

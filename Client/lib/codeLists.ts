import api from './api';

export interface CodeList {
  id: number;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  _count?: { values: number };
  values?: CodeListValue[];
}

export interface CodeListValue {
  id: number;
  codeListId: number;
  label: string;
  code: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

// ids arrive from the API as numbers; accept either when building request URLs.
type IdArg = number | string;

export const codeLists = {
  getAll: () =>
    api.get<{ status: string; data: CodeList[] }>('/system/code-lists'),

  getById: (id: IdArg) =>
    api.get<{ status: string; data: CodeList }>(`/system/code-lists/${id}`),

  create: (data: { name: string; code: string; description?: string }) =>
    api.post<{ status: string; data: CodeList }>('/system/code-lists', data),

  update: (id: IdArg, data: { name?: string; description?: string }) =>
    api.put<{ status: string; data: CodeList }>(`/system/code-lists/${id}`, data),

  createValue: (
    codeStr: string,
    data: { label: string; code?: string; description?: string }
  ) =>
    api.post<{ status: string; data: CodeListValue }>(
      `/system/code-lists/${codeStr}/values`,
      data
    ),

  updateValue: (
    codeListId: IdArg,
    valueId: IdArg,
    data: { label?: string; description?: string }
  ) =>
    api.put<{ status: string; data: CodeListValue }>(
      `/system/code-lists/${codeListId}/${valueId}`,
      data
    ),

  deactivateValue: (codeListId: IdArg, valueId: IdArg) =>
    api.put<{ status: string; data: CodeListValue }>(
      `/system/code-lists/${codeListId}/values/${valueId}/deactivate`
    ),

  activateValue: (codeListId: IdArg, valueId: IdArg) =>
    api.put<{ status: string; data: CodeListValue }>(
      `/system/code-lists/${codeListId}/values/${valueId}/activate`
    ),
};

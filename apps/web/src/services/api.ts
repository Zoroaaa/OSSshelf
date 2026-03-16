import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import type {
  User,
  FileItem,
  Share,
  ApiResponse,
  AuthLoginParams,
  AuthRegisterParams,
  AuthResponse,
  FileListParams,
  ShareCreateParams,
} from '@r2shelf/shared';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isShareApi = error.config?.url?.includes('/api/share/');
      if (!isShareApi) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  login: (params: AuthLoginParams) =>
    api.post<ApiResponse<AuthResponse>>('/api/auth/login', params),
  register: (params: AuthRegisterParams) =>
    api.post<ApiResponse<AuthResponse>>('/api/auth/register', params),
  logout: () =>
    api.post<ApiResponse<{ message: string }>>('/api/auth/logout'),
  me: () =>
    api.get<ApiResponse<User>>('/api/auth/me'),
  patchMe: (data: { name?: string; currentPassword?: string; newPassword?: string }) =>
    api.patch<ApiResponse<User>>('/api/auth/me', data),
  deleteMe: (password: string) =>
    api.delete<ApiResponse<{ message: string }>>('/api/auth/me', { data: { password } }),
  stats: () =>
    api.get<ApiResponse<DashboardStats>>('/api/auth/stats'),
};

export interface DashboardStats {
  fileCount: number;
  folderCount: number;
  trashCount: number;
  storageUsed: number;
  storageQuota: number;
  recentFiles: FileItem[];
  typeBreakdown: Record<string, number>;
}

// ── Files ─────────────────────────────────────────────────────────────────
export const filesApi = {
  list: (params?: Partial<FileListParams>) =>
    api.get<ApiResponse<FileItem[]>>('/api/files', { params }),
  get: (id: string) =>
    api.get<ApiResponse<FileItem>>(`/api/files/${id}`),
  createFolder: (name: string, parentId?: string | null) =>
    api.post<ApiResponse<FileItem>>('/api/files', { name, parentId }),
  update: (id: string, data: { name?: string; parentId?: string | null }) =>
    api.put<ApiResponse<{ message: string }>>(`/api/files/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/files/${id}`),
  move: (id: string, targetParentId: string | null) =>
    api.post<ApiResponse<{ message: string }>>(`/api/files/${id}/move`, { targetParentId }),

  upload: (file: File, parentId?: string | null, onProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    if (parentId) formData.append('parentId', parentId);
    return api.post<ApiResponse<FileItem>>('/api/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total && onProgress) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    });
  },

  download: (id: string) =>
    api.get(`/api/files/${id}/download`, { responseType: 'blob' }),
  preview: (id: string) =>
    api.get(`/api/files/${id}/preview`, { responseType: 'blob' }),
  previewUrl: (id: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/files/${id}/preview`,
  downloadUrl: (id: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/files/${id}/download`,

  // Trash
  listTrash: () =>
    api.get<ApiResponse<FileItem[]>>('/api/files/trash'),
  restoreTrash: (id: string) =>
    api.post<ApiResponse<{ message: string }>>(`/api/files/trash/${id}/restore`),
  deleteTrash: (id: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/files/trash/${id}`),
  emptyTrash: () =>
    api.delete<ApiResponse<{ message: string }>>('/api/files/trash'),
};

// ── Share ─────────────────────────────────────────────────────────────────
export const shareApi = {
  create: (params: ShareCreateParams) =>
    api.post<ApiResponse<Share>>('/api/share', params),
  list: () =>
    api.get<ApiResponse<any[]>>('/api/share'),
  delete: (id: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/share/${id}`),
  get: (id: string, password?: string) =>
    api.get<ApiResponse<any>>(`/api/share/${id}`, { params: { password } }),
  download: (id: string, password?: string) =>
    api.get(`/api/share/${id}/download`, { params: { password }, responseType: 'blob' }),
  downloadUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
};

export default api;

// ── Buckets ───────────────────────────────────────────────────────────────
export interface StorageBucket {
  id: string;
  userId: string;
  name: string;
  provider: 'r2' | 's3' | 'oss' | 'cos' | 'obs' | 'b2' | 'minio' | 'custom';
  bucketName: string;
  endpoint: string | null;
  region: string | null;
  accessKeyId: string;    // Masked on backend
  secretAccessKeyMasked: string;
  pathStyle: boolean;
  isDefault: boolean;
  isActive: boolean;
  storageUsed: number;
  fileCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BucketFormData {
  name: string;
  provider: StorageBucket['provider'];
  bucketName: string;
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle?: boolean;
  isDefault?: boolean;
  notes?: string;
}

export const PROVIDER_META: Record<StorageBucket['provider'], {
  label: string;
  color: string;
  icon: string;
  regions?: string[];
  endpointPlaceholder?: string;
  regionRequired?: boolean;
}> = {
  r2: {
    label: 'Cloudflare R2',
    color: '#F6821F',
    icon: '☁️',
    endpointPlaceholder: 'https://<accountId>.r2.cloudflarestorage.com',
  },
  s3: {
    label: 'Amazon S3',
    color: '#FF9900',
    icon: '🪣',
    regions: ['us-east-1','us-east-2','us-west-1','us-west-2','ap-east-1','ap-northeast-1','ap-northeast-2','ap-southeast-1','ap-southeast-2','eu-west-1','eu-central-1','sa-east-1'],
    regionRequired: true,
  },
  oss: {
    label: 'Aliyun OSS',
    color: '#FF6A00',
    icon: '🌐',
    regions: ['cn-hangzhou','cn-shanghai','cn-beijing','cn-shenzhen','cn-hongkong','ap-southeast-1','ap-northeast-1','us-west-1','eu-central-1'],
    regionRequired: true,
  },
  cos: {
    label: 'Tencent COS',
    color: '#1772F6',
    icon: '📦',
    regions: ['ap-guangzhou','ap-shanghai','ap-beijing','ap-chengdu','ap-chongqing','ap-hongkong','ap-singapore','na-ashburn','eu-frankfurt'],
    regionRequired: true,
  },
  obs: {
    label: 'Huawei OBS',
    color: '#CF0A2C',
    icon: '🏔️',
    regions: ['cn-north-4','cn-east-3','cn-south-1','cn-southwest-2','ap-southeast-3'],
    regionRequired: true,
  },
  b2: {
    label: 'Backblaze B2',
    color: '#D01F2E',
    icon: '🔥',
    endpointPlaceholder: 'https://s3.us-west-004.backblazeb2.com',
  },
  minio: {
    label: 'MinIO',
    color: '#C72C41',
    icon: '🐘',
    endpointPlaceholder: 'http://your-minio-server:9000',
  },
  custom: {
    label: '自定义 S3 兼容',
    color: '#6B7280',
    icon: '⚙️',
    endpointPlaceholder: 'https://your-s3-endpoint.com',
  },
};

export const bucketsApi = {
  list: () =>
    api.get<ApiResponse<StorageBucket[]>>('/api/buckets'),
  providers: () =>
    api.get<ApiResponse<Record<string, any>>>('/api/buckets/providers'),
  create: (data: BucketFormData) =>
    api.post<ApiResponse<StorageBucket>>('/api/buckets', data),
  get: (id: string) =>
    api.get<ApiResponse<StorageBucket>>(`/api/buckets/${id}`),
  update: (id: string, data: Partial<BucketFormData>) =>
    api.put<ApiResponse<StorageBucket>>(`/api/buckets/${id}`, data),
  setDefault: (id: string) =>
    api.post<ApiResponse<{ message: string }>>(`/api/buckets/${id}/set-default`),
  toggle: (id: string) =>
    api.post<ApiResponse<{ isActive: boolean }>>(`/api/buckets/${id}/toggle`),
  test: (id: string) =>
    api.post<ApiResponse<{ connected: boolean; message: string; statusCode: number }>>(`/api/buckets/${id}/test`),
  delete: (id: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/buckets/${id}`),
};

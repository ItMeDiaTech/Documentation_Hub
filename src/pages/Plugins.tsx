import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { cn } from '@/utils/cn';
import {
  Puzzle,
  Search,
  Download,
  Trash2,
  Power,
  PowerOff,
  Shield,
  Star,
  ExternalLink,
  Package,
} from 'lucide-react';

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  isEnabled: boolean;
  isInstalled: boolean;
  category: 'document' | 'ui' | 'integration' | 'automation';
  rating: number;
  downloads: number;
  verified: boolean;
}

const mockPlugins: Plugin[] = [
  {
    id: 'pdf-export',
    name: 'PDF Export',
    description: 'Export processed documents as PDF with custom formatting options',
    version: '1.2.0',
    author: 'DocHub Team',
    isEnabled: true,
    isInstalled: true,
    category: 'document',
    rating: 4.8,
    downloads: 15420,
    verified: true,
  },
  {
    id: 'cloud-sync',
    name: 'Cloud Sync',
    description: 'Automatically sync your sessions and documents to cloud storage',
    version: '2.1.0',
    author: 'DocHub Team',
    isEnabled: false,
    isInstalled: true,
    category: 'integration',
    rating: 4.6,
    downloads: 12380,
    verified: true,
  },
  {
    id: 'advanced-analytics',
    name: 'Advanced Analytics',
    description: 'Extended analytics with custom reports and data visualizations',
    version: '1.0.5',
    author: 'Community',
    isEnabled: false,
    isInstalled: false,
    category: 'automation',
    rating: 4.2,
    downloads: 8750,
    verified: false,
  },
  {
    id: 'theme-builder',
    name: 'Theme Builder',
    description: 'Create and share custom themes with the community',
    version: '1.5.2',
    author: 'DocHub Team',
    isEnabled: false,
    isInstalled: false,
    category: 'ui',
    rating: 4.9,
    downloads: 22100,
    verified: true,
  },
  {
    id: 'batch-rename',
    name: 'Batch File Renamer',
    description: 'Automatically rename processed files based on custom patterns',
    version: '1.0.0',
    author: 'Community',
    isEnabled: false,
    isInstalled: false,
    category: 'automation',
    rating: 4.0,
    downloads: 5230,
    verified: false,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
    },
  },
};

export function Plugins() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [plugins, setPlugins] = useState<Plugin[]>(mockPlugins);

  const categories = [
    { value: 'all', label: 'All Plugins' },
    { value: 'document', label: 'Document' },
    { value: 'ui', label: 'UI & Theme' },
    { value: 'integration', label: 'Integration' },
    { value: 'automation', label: 'Automation' },
  ];

  const filteredPlugins = plugins.filter((plugin) => {
    const matchesSearch =
      plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'all' || plugin.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleToggle = (pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === pluginId ? { ...p, isEnabled: !p.isEnabled } : p
      )
    );
  };

  const handleInstall = (pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === pluginId ? { ...p, isInstalled: true, isEnabled: true } : p
      )
    );
  };

  const handleUninstall = (pluginId: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === pluginId ? { ...p, isInstalled: false, isEnabled: false } : p
      )
    );
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'document':
        return Package;
      case 'ui':
        return Puzzle;
      case 'integration':
        return ExternalLink;
      case 'automation':
        return Power;
      default:
        return Package;
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-6 space-y-6 max-w-[1400px] mx-auto"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Puzzle className="w-8 h-8" />
          Plugins
        </h1>
        <p className="text-muted-foreground">
          Extend functionality with community and official plugins
        </p>
      </motion.div>

      {/* Search & Filters */}
      <motion.div variants={itemVariants} className="space-y-4">
        <div className="relative">
          <Input
            type="text"
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        </div>

        <div className="flex gap-2 flex-wrap">
          {categories.map((category) => (
            <Button
              key={category.value}
              variant={selectedCategory === category.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(category.value)}
            >
              {category.label}
            </Button>
          ))}
        </div>
      </motion.div>

      {/* Plugin Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Installed</p>
                <p className="text-2xl font-bold">
                  {plugins.filter((p) => p.isInstalled).length}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10">
                <Download className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Active</p>
                <p className="text-2xl font-bold">
                  {plugins.filter((p) => p.isEnabled).length}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-blue-500/10">
                <Power className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Available</p>
                <p className="text-2xl font-bold">{plugins.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-purple-500/10">
                <Puzzle className="w-6 h-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Plugins List */}
      <motion.div variants={itemVariants} className="space-y-4">
        {filteredPlugins.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-12 pb-12 text-center">
              <Puzzle className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg font-medium mb-1">No plugins found</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting your search query or filters
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredPlugins.map((plugin) => {
            const CategoryIcon = getCategoryIcon(plugin.category);
            return (
              <motion.div key={plugin.id} variants={itemVariants}>
                <Card className={cn(
                  'transition-all duration-150 hover:border-primary/50',
                  plugin.isEnabled && 'border-primary/30 bg-accent/20'
                )}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4 flex-1">
                        <div className={cn(
                          'p-3 rounded-lg',
                          plugin.isEnabled ? 'bg-primary/10' : 'bg-muted'
                        )}>
                          <CategoryIcon className={cn(
                            'w-6 h-6',
                            plugin.isEnabled ? 'text-primary' : 'text-muted-foreground'
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <CardTitle className="text-xl">{plugin.name}</CardTitle>
                            {plugin.verified && (
                              <Shield className="w-4 h-4 text-blue-500" title="Verified" />
                            )}
                          </div>
                          <CardDescription className="mb-3">
                            {plugin.description}
                          </CardDescription>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500" />
                              {plugin.rating}
                            </span>
                            <span>{plugin.downloads.toLocaleString()} downloads</span>
                            <span>v{plugin.version}</span>
                            <span>by {plugin.author}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {plugin.isInstalled ? (
                          <>
                            <Button
                              variant={plugin.isEnabled ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => handleToggle(plugin.id)}
                              className="gap-2"
                            >
                              {plugin.isEnabled ? (
                                <>
                                  <Power className="w-4 h-4" />
                                  Enabled
                                </>
                              ) : (
                                <>
                                  <PowerOff className="w-4 h-4" />
                                  Disabled
                                </>
                              )}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleUninstall(plugin.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleInstall(plugin.id)}
                            className="gap-2"
                          >
                            <Download className="w-4 h-4" />
                            Install
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </motion.div>
            );
          })
        )}
      </motion.div>
    </motion.div>
  );
}

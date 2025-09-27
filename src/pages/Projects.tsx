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
import { Plus, FolderOpen, Clock, Users, MoreVertical, Grid, List } from 'lucide-react';
import { cn } from '@/utils/cn';

const projects = [
  {
    id: 1,
    name: 'E-Commerce Platform',
    description: 'Modern online shopping platform with AI recommendations',
    status: 'In Progress',
    progress: 65,
    team: 5,
    updated: '2 hours ago',
    color: 'bg-blue-500',
  },
  {
    id: 2,
    name: 'Mobile Banking App',
    description: 'Secure and intuitive mobile banking solution',
    status: 'Planning',
    progress: 20,
    team: 3,
    updated: '1 day ago',
    color: 'bg-purple-500',
  },
  {
    id: 3,
    name: 'Analytics Dashboard',
    description: 'Real-time data visualization and reporting tool',
    status: 'In Progress',
    progress: 80,
    team: 4,
    updated: '3 hours ago',
    color: 'bg-green-500',
  },
  {
    id: 4,
    name: 'Content Management System',
    description: 'Flexible CMS for enterprise content management',
    status: 'Review',
    progress: 90,
    team: 6,
    updated: '5 hours ago',
    color: 'bg-orange-500',
  },
  {
    id: 5,
    name: 'Social Media Platform',
    description: 'Next-generation social networking application',
    status: 'Planning',
    progress: 15,
    team: 8,
    updated: '2 days ago',
    color: 'bg-pink-500',
  },
  {
    id: 6,
    name: 'IoT Management System',
    description: 'Cloud-based IoT device management and monitoring',
    status: 'In Progress',
    progress: 45,
    team: 4,
    updated: '6 hours ago',
    color: 'bg-indigo-500',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
};

export function Projects() {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div
      className="p-6 space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants}>
        <h1 className="text-3xl font-bold">Projects</h1>
        <p className="text-muted-foreground">Manage and track all your projects in one place</p>
      </motion.div>

      <motion.div
        className="flex flex-col sm:flex-row gap-4 justify-between"
        variants={itemVariants}
      >
        <Input
          type="search"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery('')}
          className="max-w-md"
        />

        <div className="flex gap-2">
          <div className="flex rounded-md border border-border">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-2 rounded-l-md transition-colors',
                viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              aria-label="Grid view"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-2 rounded-r-md transition-colors',
                viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <Button icon={<Plus className="w-4 h-4" />}>New Project</Button>
        </div>
      </motion.div>

      <motion.div
        className={cn(
          'grid gap-4',
          viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'
        )}
        variants={containerVariants}
      >
        {filteredProjects.map((project) => (
          <motion.div key={project.id} variants={itemVariants}>
            <Card interactive variant="bordered">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center',
                        project.color
                      )}
                    >
                      <FolderOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{project.name}</CardTitle>
                      <span
                        className={cn(
                          'text-xs px-2 py-1 rounded-full mt-1 inline-block',
                          project.status === 'In Progress' &&
                            'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
                          project.status === 'Planning' &&
                            'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
                          project.status === 'Review' &&
                            'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                        )}
                      >
                        {project.status}
                      </span>
                    </div>
                  </div>
                  <button className="p-1 hover:bg-muted rounded">
                    <MoreVertical className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-4">{project.description}</CardDescription>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{project.progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className={project.color}
                        initial={{ width: 0 }}
                        animate={{ width: `${project.progress}%` }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        style={{ height: '100%' }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Users className="w-3 h-3" />
                      <span>{project.team} members</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{project.updated}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {filteredProjects.length === 0 && (
        <motion.div variants={itemVariants} className="text-center py-12">
          <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No projects found</h3>
          <p className="text-muted-foreground">Try adjusting your search or create a new project</p>
        </motion.div>
      )}
    </motion.div>
  );
}

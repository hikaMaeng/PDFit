import React, { useState } from 'react';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StorageIcon from '@mui/icons-material/Storage';
import AIServersTab from './settings/AIServersTab';
import PGVectorTab from './settings/PGVectorTab';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      sx={{ pt: 3 }}
    >
      {value === index ? children : null}
    </Box>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Settings
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_event, nextValue: number) => setTab(nextValue)} aria-label="settings tabs">
          <Tab
            icon={<SmartToyIcon fontSize="small" />}
            iconPosition="start"
            label="AI Servers"
            id="settings-tab-0"
            aria-controls="settings-tabpanel-0"
          />
          <Tab
            icon={<StorageIcon fontSize="small" />}
            iconPosition="start"
            label="PGVector"
            id="settings-tab-1"
            aria-controls="settings-tabpanel-1"
          />
        </Tabs>
      </Box>

      <TabPanel value={tab} index={0}>
        <AIServersTab />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <PGVectorTab />
      </TabPanel>
    </Box>
  );
}

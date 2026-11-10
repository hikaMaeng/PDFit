import React, { useState } from 'react';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AIServersTab from './settings/AIServersTab';
import { usePdfitI18n } from '@pdfit/pdfit/client/service';

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
  const { t } = usePdfitI18n();
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {t('settings')}
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_event, nextValue: number) => setTab(nextValue)} aria-label={t('settings')}>
          <Tab
            icon={<SmartToyIcon fontSize="small" />}
            iconPosition="start"
            label={t('aiServers')}
            id="settings-tab-0"
            aria-controls="settings-tabpanel-0"
          />
        </Tabs>
      </Box>

      <TabPanel value={tab} index={0}>
        <AIServersTab />
      </TabPanel>
    </Box>
  );
}

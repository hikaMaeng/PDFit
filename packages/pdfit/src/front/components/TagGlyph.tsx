import type { SvgIconProps } from '@mui/material';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined';
import StarOutlineOutlinedIcon from '@mui/icons-material/StarOutlineOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import MusicNoteOutlinedIcon from '@mui/icons-material/MusicNoteOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import { DEFAULT_TAG_ICON, isTagIconName, type TagIconName } from '../../shared/tagDetails.js';

const glyphs = {
  tag: LocalOfferOutlinedIcon,
  book: MenuBookOutlinedIcon,
  code: CodeOutlinedIcon,
  science: ScienceOutlinedIcon,
  school: SchoolOutlinedIcon,
  work: WorkOutlineOutlinedIcon,
  star: StarOutlineOutlinedIcon,
  lightbulb: LightbulbOutlinedIcon,
  language: LanguageOutlinedIcon,
  palette: PaletteOutlinedIcon,
  music: MusicNoteOutlinedIcon,
  build: BuildOutlinedIcon,
};

export default function TagGlyph({ icon, ...props }: SvgIconProps & { icon?: TagIconName }) {
  const name = isTagIconName(icon) ? icon : DEFAULT_TAG_ICON;
  const Glyph = glyphs[name];
  return <Glyph {...props} data-tag-icon={name} aria-hidden />;
}

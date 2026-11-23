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
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import PhoneAndroidOutlinedIcon from '@mui/icons-material/PhoneAndroidOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import BiotechOutlinedIcon from '@mui/icons-material/BiotechOutlined';
import MedicalServicesOutlinedIcon from '@mui/icons-material/MedicalServicesOutlined';
import FavoriteBorderOutlinedIcon from '@mui/icons-material/FavoriteBorderOutlined';
import PsychologyOutlinedIcon from '@mui/icons-material/PsychologyOutlined';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import FactoryOutlinedIcon from '@mui/icons-material/FactoryOutlined';
import ArchitectureOutlinedIcon from '@mui/icons-material/ArchitectureOutlined';
import FlightOutlinedIcon from '@mui/icons-material/FlightOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import HistoryEduOutlinedIcon from '@mui/icons-material/HistoryEduOutlined';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import MovieOutlinedIcon from '@mui/icons-material/MovieOutlined';
import HeadphonesOutlinedIcon from '@mui/icons-material/HeadphonesOutlined';
import SportsSoccerOutlinedIcon from '@mui/icons-material/SportsSoccerOutlined';
import ParkOutlinedIcon from '@mui/icons-material/ParkOutlined';
import PetsOutlinedIcon from '@mui/icons-material/PetsOutlined';
import RestaurantOutlinedIcon from '@mui/icons-material/RestaurantOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
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
  robot: SmartToyOutlinedIcon,
  terminal: TerminalOutlinedIcon,
  database: StorageOutlinedIcon,
  cloud: CloudOutlinedIcon,
  network: HubOutlinedIcon,
  security: ShieldOutlinedIcon,
  lock: LockOutlinedIcon,
  chip: MemoryOutlinedIcon,
  devices: DevicesOutlinedIcon,
  phone: PhoneAndroidOutlinedIcon,
  chart: BarChartOutlinedIcon,
  math: CalculateOutlinedIcon,
  biotech: BiotechOutlinedIcon,
  medicine: MedicalServicesOutlinedIcon,
  health: FavoriteBorderOutlinedIcon,
  psychology: PsychologyOutlinedIcon,
  finance: AccountBalanceWalletOutlinedIcon,
  commerce: StorefrontOutlinedIcon,
  factory: FactoryOutlinedIcon,
  architecture: ArchitectureOutlinedIcon,
  travel: FlightOutlinedIcon,
  map: MapOutlinedIcon,
  history: HistoryEduOutlinedIcon,
  law: GavelOutlinedIcon,
  people: GroupsOutlinedIcon,
  chat: ForumOutlinedIcon,
  writing: EditNoteOutlinedIcon,
  image: ImageOutlinedIcon,
  video: MovieOutlinedIcon,
  audio: HeadphonesOutlinedIcon,
  sports: SportsSoccerOutlinedIcon,
  nature: ParkOutlinedIcon,
  animals: PetsOutlinedIcon,
  food: RestaurantOutlinedIcon,
  home: HomeOutlinedIcon,
  space: RocketLaunchOutlinedIcon,
} satisfies Record<TagIconName, typeof LocalOfferOutlinedIcon>;

export default function TagGlyph({ icon, ...props }: SvgIconProps & { icon?: TagIconName }) {
  const name = isTagIconName(icon) ? icon : DEFAULT_TAG_ICON;
  const Glyph = glyphs[name];
  return <Glyph {...props} data-tag-icon={name} aria-hidden />;
}

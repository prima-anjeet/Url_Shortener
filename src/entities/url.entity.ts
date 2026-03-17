import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('urls')
export class Url {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20 })
  short_code: string;

  @Column({ type: 'text' })
  original_url: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  user_id: string | null;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
